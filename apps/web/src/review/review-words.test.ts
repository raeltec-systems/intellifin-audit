import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EMPTY_STATES } from '../design/copy';
import {
  OPEN_RESULT,
  OPEN_VERSION_REVIEW,
  PENDING_RESULTS_UNREADABLE,
  PROCEDURES_TAB_AUDITOR_EMPTY,
  PROCEDURES_TAB_AUDITOR_HEADING,
  PROCEDURES_TAB_AUDITOR_SENTENCE,
  PROCEDURES_TAB_HEADING,
  RESULTS_TAB_EMPTY,
  RESULT_REVIEW_MANAGER_NOTE,
  RESULT_REVIEW_UNAVAILABLE_BODY,
  RESULT_REVIEW_UNAVAILABLE_TITLE,
  REVIEWS_LEDE,
  REVIEWS_NOT_YOUR_QUEUE,
  REVIEWS_TITLE,
  REVIEW_TABS,
  resultTabHref,
  SUBMITTED_VERSIONS_UNREADABLE,
  reviewsBounded,
} from './review-words';

/**
 * The Reviews area's sentences, pinned here (UI cleanup 2026-09-22, UX-30/35/36).
 *
 * The `run-start-words.ts` rule: a sentence retyped in a component or a browser spec is a
 * sentence pinned against nothing. These are the platform's OWN words — not quotations
 * from the UX contract, which stay in `copy.ts` and are pinned against EXPERIENCE.md on
 * disk — so what this file checks is that they exist, that they obey the product's rules,
 * and that the two pages render them from here.
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('the Reviews area words', () => {
  it('names the area in the plural, because it holds two queues', () => {
    expect(REVIEWS_TITLE).toBe('Reviews');
    expect(REVIEWS_LEDE).toContain('Procedure Versions');
    expect(REVIEWS_LEDE).toContain('confirming');
  });

  it('lands the sidebar link on Procedures, which is the queue this release can act on', () => {
    expect(REVIEW_TABS.procedures.href).toBe('/review');
    expect(REVIEW_TABS.results.href).toBe('/review/results');
    expect(REVIEW_TABS.procedures.label).toBe('Procedures');
    expect(REVIEW_TABS.results.label).toBe('Results');
  });

  it('asks an Auditor for nothing, because they cannot approve their own work', () => {
    // A queue headed "awaiting approval" shown to somebody who may not approve invites an
    // action every surface below it will refuse.
    expect(PROCEDURES_TAB_HEADING).toContain('awaiting approval');
    expect(PROCEDURES_TAB_AUDITOR_HEADING).toContain('waiting for an Audit Manager');
    expect(PROCEDURES_TAB_AUDITOR_SENTENCE).toContain('nothing here needs anything from you');
  });

  it('states that Result review is unavailable rather than showing an empty queue', () => {
    // EXPERIENCE.md: "Each surface states its availability truthfully rather than showing
    // an ordinary empty state." A queue saying "nothing awaits your decision" would say
    // the platform is quiet about a capability it does not have.
    expect(RESULT_REVIEW_UNAVAILABLE_TITLE).toContain('not available yet');
    expect(RESULT_REVIEW_UNAVAILABLE_BODY).toContain('cannot yet be submitted, approved or finalized');
    expect(RESULT_REVIEW_MANAGER_NOTE).toContain('nothing for an Audit Manager to approve');
  });

  it('gives every empty state of ours the EmptyState rule', () => {
    for (const state of [PROCEDURES_TAB_AUDITOR_EMPTY, RESULTS_TAB_EMPTY]) {
      expect(state.sentence.length).toBeGreaterThan(40);
      expect(state.sentence.trim().endsWith('.')).toBe(true);
      expect(state.sentence).toContain('does not mean a control passed');
    }
  });

  it('says what could not be read rather than rendering an absence', () => {
    // Story 5.6's rule: an unreadable read is NEVER an absence. Both sentences name what
    // could not be read and what to do, and neither claims the queue is empty.
    for (const sentence of [PENDING_RESULTS_UNREADABLE, SUBMITTED_VERSIONS_UNREADABLE]) {
      expect(sentence).toContain('could not be read');
      expect(sentence).toContain('Reload the page');
    }
  });

  it('counts a bounded queue exactly, and offers one way onward per row', () => {
    expect(reviewsBounded(5, 12)).toBe('Showing the first 5 of 12.');
    expect(OPEN_VERSION_REVIEW).toBe('Open the version review');
    expect(OPEN_RESULT).toBe('Open the Result');
  });

  it('is rendered from this module by both Reviews pages, never retyped', () => {
    for (const path of ['../../app/review/page.tsx', '../../app/review/results/page.tsx']) {
      const source = read(path);
      expect(source, path).toContain("review-words");
      expect(source, path).not.toContain('Submitting a Result for review');
      expect(source, path).not.toContain('Reviews are for the people who');
    }
    // And the contract's own empty state stays in `copy.ts`: `copy.test.ts` requires the
    // Procedures tab to render `EMPTY_STATES`, which is what stops it being retyped.
    expect(read('../../app/review/page.tsx')).toContain('EMPTY_STATES');
    expect(EMPTY_STATES.reviewQueueEmpty.headline).toContain('No Procedure Version');
  });

  it('tells a role with no review work where its own work is', () => {
    expect(REVIEWS_NOT_YOUR_QUEUE).toContain('Administration');
    expect(REVIEWS_NOT_YOUR_QUEUE).not.toContain('permit');
  });
  it("links a Result to the Run's own page, which is where the Result tab is", () => {
    // `[ADDED 2026-09-22]` Both queues linked `/runs/{id}/result`, which is no route at
    // all, and a browser assertion on the `href` agreed with the component that wrote it.
    const id = '019823ab-0000-7000-8000-000000000004';
    expect(resultTabHref(id)).toBe(`/runs/${id}`);
    const runRoute = fileURLToPath(new URL('../../app/runs/[id]/', import.meta.url));
    expect(existsSync(`${runRoute}page.tsx`)).toBe(true);
    expect(existsSync(`${runRoute}result`)).toBe(false);
  });
});
